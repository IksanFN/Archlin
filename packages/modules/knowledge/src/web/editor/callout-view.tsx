import { CALLOUT_VARIANTS, type CalloutVariant } from '@archlin/modules-knowledge/shared';
import { Button } from '@archlin/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@archlin/ui/components/dropdown-menu';
import { CheckCircleIcon, InfoIcon, WarningIcon, WarningOctagonIcon } from '@phosphor-icons/react/ssr';
import type { Icon } from '@phosphor-icons/react';
import type { NodeViewProps } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import type { EditorLabels } from './labels';

const VARIANT_ICONS: Record<CalloutVariant, { icon: Icon; className: string }> = {
  info: { icon: InfoIcon, className: 'text-info' },
  warning: { icon: WarningIcon, className: 'text-attention' },
  danger: { icon: WarningOctagonIcon, className: 'text-danger' },
  success: { icon: CheckCircleIcon, className: 'text-success' },
};

function isCalloutVariant(value: string): value is CalloutVariant {
  return (CALLOUT_VARIANTS as readonly string[]).includes(value);
}

export function CalloutView({ node, updateAttributes, editor, labels }: NodeViewProps & { labels: EditorLabels }) {
  const rawVariant = String(node.attrs.variant);
  const variant: CalloutVariant = isCalloutVariant(rawVariant) ? rawVariant : 'info';
  const current = VARIANT_ICONS[variant];
  const CurrentIcon = current.icon;
  const editable = editor.isEditable;

  return (
    <NodeViewWrapper className="kb-callout rounded-md bg-surface px-3.5 py-3" data-callout="" data-variant={variant}>
      <div className="flex items-start gap-2.5">
        <div className="pt-0.5" contentEditable={false}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={labels.calloutVariant}
                disabled={!editable}
                className={current.className}
              >
                <CurrentIcon aria-hidden="true" size={18} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={variant}
                onValueChange={(value) => {
                  if (isCalloutVariant(value)) updateAttributes({ variant: value });
                }}
              >
                {CALLOUT_VARIANTS.map((id) => {
                  const item = VARIANT_ICONS[id];
                  const ItemIcon = item.icon;
                  return (
                    <DropdownMenuRadioItem key={id} value={id}>
                      <ItemIcon aria-hidden="true" size={16} className={item.className} />
                      {labels.callout[id]}
                    </DropdownMenuRadioItem>
                  );
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <NodeViewContent className="min-w-0 flex-1" />
      </div>
    </NodeViewWrapper>
  );
}
