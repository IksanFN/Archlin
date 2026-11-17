process.once('message', () => {
  process.send({ status: 'ok' }, () => process.exit(0));
});
