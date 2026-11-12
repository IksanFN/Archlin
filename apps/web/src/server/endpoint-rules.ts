import ts from 'typescript';

export type EndpointRule =
  | 'create_server_fn_outside_fn_ts'
  | 'handler_without_guarded_builder'
  | 'handler_without_strict_input'
  | 'public_fn_not_allowlisted'
  | 'route_handler_not_wrapped'
  | 'public_route_not_allowlisted';

export interface EndpointViolation {
  file: string;
  line: number;
  rule: EndpointRule;
}

export interface SourceFile {
  path: string;
  text: string;
}

// Spec 13.4 K2: every endpoint is built from a guarded builder, and the public ones are listed here by name.
const FN_MODULE = '~/server/fn';
const FN_FILE = 'src/server/fn.ts';
const HEALTH_ROUTE_FILE = 'src/routes/health.ts';
const GUARDED_BUILDERS = new Set(['publicFn', 'authedFn']);
const PUBLIC_FN_ALLOWLIST = new Set(['authStateFn', 'setupFn', 'loginFn', 'loginTotpFn']);
const ROUTE_WRAPPERS = new Set(['publicRoute', 'authedRoute', 'tokenRoute']);

// Local name -> exported name, for what this file imports from the guarded fn module.
function fnImportsOf(sf: ts.SourceFile): Map<string, string> {
  const imports = new Map<string, string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== FN_MODULE) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      imports.set(element.name.text, (element.propertyName ?? element.name).text);
    }
  }
  return imports;
}

function chainOf(call: ts.CallExpression): { root: ts.Expression; calls: ts.CallExpression[] } {
  const calls: ts.CallExpression[] = [];
  let current: ts.Expression = call;
  for (;;) {
    if (ts.isCallExpression(current)) {
      calls.push(current);
      current = current.expression;
    } else if (ts.isPropertyAccessExpression(current) || ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current)) {
      current = current.expression;
    } else {
      return { root: current, calls };
    }
  }
}

const calleeName = (call: ts.CallExpression): string | null =>
  ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : null;

function hasStrictInput(calls: readonly ts.CallExpression[], fnImports: ReadonlyMap<string, string>): boolean {
  return calls.some((call) => {
    const argument = call.arguments[0];
    return (
      calleeName(call) === 'validator' &&
      argument !== undefined &&
      ts.isCallExpression(argument) &&
      ts.isIdentifier(argument.expression) &&
      fnImports.get(argument.expression.text) === 'strictInput'
    );
  });
}

function isAllowlistedPublicExport(call: ts.CallExpression): boolean {
  const declaration = call.parent;
  if (!ts.isVariableDeclaration(declaration) || declaration.initializer !== call || !ts.isIdentifier(declaration.name)) {
    return false;
  }
  const statement = declaration.parent.parent;
  const exported = ts.isVariableStatement(statement) && statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  return exported === true && PUBLIC_FN_ALLOWLIST.has(declaration.name.text);
}

const propertyNamed = (object: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined =>
  object.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name,
  );

const isWrappedHandler = (expression: ts.Expression): boolean =>
  ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && ROUTE_WRAPPERS.has(expression.expression.text);

function checkFileRoute(call: ts.CallExpression, report: (node: ts.Node, rule: EndpointRule) => void): void {
  const options = call.arguments[0];
  if (!options || !ts.isObjectLiteralExpression(options)) return;
  const server = propertyNamed(options, 'server');
  if (!server) return;
  if (!ts.isObjectLiteralExpression(server.initializer)) {
    report(server, 'route_handler_not_wrapped');
    return;
  }
  const handlers = propertyNamed(server.initializer, 'handlers');
  if (!handlers) return;
  if (!ts.isObjectLiteralExpression(handlers.initializer)) {
    report(handlers, 'route_handler_not_wrapped');
    return;
  }
  for (const property of handlers.initializer.properties) {
    if (!ts.isPropertyAssignment(property) || !isWrappedHandler(property.initializer)) {
      report(property, 'route_handler_not_wrapped');
    }
  }
}

function checkFile({ path, text }: SourceFile): EndpointViolation[] {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const fnImports = fnImportsOf(sf);
  const violations: EndpointViolation[] = [];
  let reportedCreateServerFn = false;

  const report = (node: ts.Node, rule: EndpointRule): void => {
    violations.push({ file: path, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, rule });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === 'createServerFn' && path !== FN_FILE && !reportedCreateServerFn) {
      reportedCreateServerFn = true;
      report(node, 'create_server_fn_outside_fn_ts');
    }

    if (ts.isCallExpression(node)) {
      if (calleeName(node) === 'handler') {
        const { root, calls } = chainOf(node);
        const builder = ts.isIdentifier(root) ? fnImports.get(root.text) : undefined;
        if (builder === undefined || !GUARDED_BUILDERS.has(builder)) {
          report(node, 'handler_without_guarded_builder');
        } else {
          if (!hasStrictInput(calls, fnImports)) report(node, 'handler_without_strict_input');
          if (builder === 'publicFn' && !isAllowlistedPublicExport(node)) report(node, 'public_fn_not_allowlisted');
        }
      }

      if (ts.isIdentifier(node.expression) && node.expression.text === 'publicRoute' && path !== HEALTH_ROUTE_FILE) {
        report(node, 'public_route_not_allowlisted');
      }

      const callee = node.expression;
      if (ts.isCallExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'createFileRoute') {
        checkFileRoute(node, report);
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  return violations;
}

// Static check behind the K2 enumeration test: it reads source text only, so nothing needs to be imported or run.
export function checkServerEndpoints(files: readonly SourceFile[]): EndpointViolation[] {
  return files.flatMap(checkFile);
}
