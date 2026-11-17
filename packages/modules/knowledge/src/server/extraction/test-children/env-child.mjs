// Answers with the names of the environment variables it can see, so a runner test can prove secrets stay behind.
process.once('message', async () => {
  for await (const chunk of process.stdin) void chunk;
  process.send({ status: 'done', text: Object.keys(process.env).sort().join(',') }, () => process.exit(0));
});
