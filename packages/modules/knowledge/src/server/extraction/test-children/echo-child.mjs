// Answers with the bytes it reads from stdin, so a runner test can prove the bytes arrive intact.
process.once('message', async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  process.send({ status: 'done', text: Buffer.concat(chunks).toString('utf8') }, () => process.exit(0));
});
