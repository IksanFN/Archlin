// Never answers: only the runner's timeout can end it.
process.once('message', () => {
  setInterval(() => {}, 1000);
});
