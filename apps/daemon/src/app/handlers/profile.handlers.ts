import type { THandlers } from "#src/infra/rpc/index.js";

import type { TModules } from "../app.types.js";

export function profileHandlers(
  m: TModules,
): Pick<
  THandlers,
  "profile.list" | "profile.create" | "profile.remove" | "profile.loginStatus" | "profile.loginCommand"
> {
  return {
    "profile.list": (a) => m.profiles.list(a.agent),
    "profile.create": (a) => m.profiles.create(a.agent, a.name, a.color),
    "profile.remove": (a) => {
      m.profiles.remove(a.profileId);
      return {};
    },
    "profile.loginStatus": (a) => m.profiles.loginStatus(a.profileId),
    "profile.loginCommand": (a) => m.profiles.loginCommand(a.profileId),
  };
}
