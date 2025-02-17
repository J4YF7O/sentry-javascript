import { Integration } from '@sentry/types';

export type UserIntegrationsFunction = (integrations: Integration[]) => Integration[];
export type UserIntegrations = Integration[] | UserIntegrationsFunction;

type ForcedIntegrationOptions = {
  [keyPath: string]: unknown;
};

export type IntegrationWithExclusionOption = Integration & {
  /**
   * Allow the user to exclude this integration by not returning it from a function provided as the `integrations` option
   * in `Sentry.init()`. Meant to be used with default integrations, the idea being that if a user has actively filtered
   * an integration out, we should be able to respect that choice if we wish.
   */
  allowExclusionByUser?: boolean;
};

/**
 * Recursively traverses an object to update an existing nested key.
 * Note: The provided key path must include existing properties,
 * the function will not create objects while traversing.
 *
 * @param obj An object to update
 * @param value The value to update the nested key with
 * @param keyPath The path to the key to update ex. fizz.buzz.foo
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setNestedKey(obj: Record<string, any>, keyPath: string, value: unknown): void {
  // Ex. foo.bar.zoop will extract foo and bar.zoop
  const match = keyPath.match(/([a-z_]+)\.(.*)/i);
  // The match will be null when there's no more recursing to do, i.e., when we've reached the right level of the object
  if (match === null) {
    obj[keyPath] = value;
  } else {
    // `match[1]` is the initial segment of the path, and `match[2]` is the remainder of the path
    const innerObj = obj[match[1]];
    setNestedKey(innerObj, match[2], value);
  }
}

/**
 * Enforces inclusion of a given integration with specified options in an integration array originally determined by the
 * user, by either including the given default instance or by patching an existing user instance with the given options.
 *
 * Ideally this would happen when integrations are set up, but there isn't currently a mechanism there for merging
 * options from a default integration instance with those from a user-provided instance of the same integration, only
 * for allowing the user to override a default instance entirely. (TODO: Fix that.)
 *
 * @param defaultIntegrationInstance An instance of the integration with the correct options already set
 * @param userIntegrations Integrations defined by the user.
 * @param forcedOptions Options with which to patch an existing user-derived instance on the integration.
 * @returns A final integrations array.
 */
export function addOrUpdateIntegration<T extends UserIntegrations>(
  defaultIntegrationInstance: Integration,
  userIntegrations: T,
  forcedOptions: ForcedIntegrationOptions = {},
): T {
  return (
    Array.isArray(userIntegrations)
      ? addOrUpdateIntegrationInArray(defaultIntegrationInstance, userIntegrations, forcedOptions)
      : addOrUpdateIntegrationInFunction(
          defaultIntegrationInstance,
          // Somehow TS can't figure out that not being an array makes this necessarily a function
          userIntegrations as UserIntegrationsFunction,
          forcedOptions,
        )
  ) as T;
}

function addOrUpdateIntegrationInArray(
  defaultIntegrationInstance: Integration,
  userIntegrations: Integration[],
  forcedOptions: ForcedIntegrationOptions,
): Integration[] {
  const userInstance = userIntegrations.find(integration => integration.name === defaultIntegrationInstance.name);

  if (userInstance) {
    for (const [keyPath, value] of Object.entries(forcedOptions)) {
      setNestedKey(userInstance, keyPath, value);
    }

    return userIntegrations;
  }

  return [...userIntegrations, defaultIntegrationInstance];
}

function addOrUpdateIntegrationInFunction(
  defaultIntegrationInstance: IntegrationWithExclusionOption,
  userIntegrationsFunc: UserIntegrationsFunction,
  forcedOptions: ForcedIntegrationOptions,
): UserIntegrationsFunction {
  const wrapper: UserIntegrationsFunction = defaultIntegrations => {
    const userFinalIntegrations = userIntegrationsFunc(defaultIntegrations);

    // There are instances where we want the user to be able to prevent an integration from appearing at all, which they
    // would do by providing a function which filters out the integration in question. If that's happened in one of
    // those cases, don't add our default back in.
    if (defaultIntegrationInstance.allowExclusionByUser) {
      const userFinalInstance = userFinalIntegrations.find(
        integration => integration.name === defaultIntegrationInstance.name,
      );
      if (!userFinalInstance) {
        return userFinalIntegrations;
      }
    }

    return addOrUpdateIntegrationInArray(defaultIntegrationInstance, userFinalIntegrations, forcedOptions);
  };

  return wrapper;
}
