// kit.retry(request, { tries }): kit.http, tried again after a 429 or a 5xx (waiting as the answer's
// retry-after says, else longer each time, at most 10 s) and after a server that didn't answer (an
// error named Unreachable); answers the last answer, or throws the last failure.
kit.retry = async function (request, options) {
  const tries = Math.min((options && options.tries) || 3, 6);
  for (let attempt = 1; ; attempt++) {
    let answer;
    try {
      answer = await kit.http(request);
    } catch (e) {
      if (attempt >= tries || e.name !== "Unreachable") throw e;
      await kit.sleep(1000 * attempt);
      continue;
    }
    if (attempt >= tries || !(answer.status === 429 || answer.status >= 500)) return answer;
    const after = Number(answer.headers["retry-after"]);
    await kit.sleep(after > 0 ? after * 1000 : 1000 * attempt);
  }
};
