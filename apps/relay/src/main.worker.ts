import { handleWorkerFetch, type TWorkerEnv } from "#src/app/worker-host.js";

export { DirectoryDO, HubDO } from "#src/app/worker-host.js";

const worker = {
  fetch: (req: Request, env: TWorkerEnv): Promise<Response> => handleWorkerFetch(req, env),
};

export default worker;
