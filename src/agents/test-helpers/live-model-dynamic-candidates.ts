/**
 * Dynamic live-model candidate expansion.
 * Adds prioritized plugin-discovered live models to static catalog candidates
 * while keeping the hot catalog path provider-agnostic.
 */
import {
  findNormalizedProviderValue,
  normalizeProviderId,
} from "@openclaw/model-catalog-core/provider-id";
import { normalizeLowercaseStringOrEmpty } from "@openclaw/normalization-core/string-coerce";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { Model } from "../../llm/types.js";
import { withBundledPluginEnablementCompat } from "../../plugins/bundled-compat.js";
import type {
  prepareProviderDynamicModel,
  runProviderDynamicModel,
} from "../../plugins/provider-runtime.js";
import { resolveOwningPluginIdsForProviderRef } from "../../plugins/providers.js";
import type { ProviderResolveDynamicModelContext } from "../../plugins/types.js";
import { createLazyImportLoader } from "../../shared/lazy-promise.js";
import { listPrioritizedHighSignalLiveModelRefs } from "../live-model-filter.js";

type ProviderRuntimeModule = typeof import("../../plugins/provider-runtime.js");
type DynamicModelResolver = typeof runProviderDynamicModel;
type DynamicModelPreparer = typeof prepareProviderDynamicModel;
type DynamicModelNormalizer = (model: Model, agentDir: string) => Model | Promise<Model>;

const providerRuntimeLoader = createLazyImportLoader<ProviderRuntimeModule>(
  () => import("../../plugins/provider-runtime.js"),
);

async function prepareProviderDynamicModelDefault(
  params: Parameters<DynamicModelPreparer>[0],
): ReturnType<DynamicModelPreparer> {
  const { prepareProviderDynamicModel } = await providerRuntimeLoader.load();
  return await prepareProviderDynamicModel(params);
}

async function runProviderDynamicModelDefault(
  params: Parameters<DynamicModelResolver>[0],
): Promise<ReturnType<DynamicModelResolver>> {
  const { runProviderDynamicModel } = await providerRuntimeLoader.load();
  return runProviderDynamicModel(params);
}

async function normalizeDynamicModelDefault(
  model: Model,
  agentDir: string,
  options: { config?: OpenClawConfig; workspaceDir?: string },
): Promise<Model> {
  const { normalizeDiscoveredAgentModel } = await import("../agent-model-discovery.js");
  return normalizeDiscoveredAgentModel(model, agentDir, options);
}

function liveModelKey(provider: string, id: string): string | null {
  const normalizedProvider = normalizeProviderId(provider);
  const normalizedId = normalizeLowercaseStringOrEmpty(id);
  return normalizedProvider && normalizedId ? `${normalizedProvider}/${normalizedId}` : null;
}

export function resolveLiveProviderDiscoveryProviderIds(params: {
  providerFilter: ReadonlySet<string> | null;
  explicitRefs: readonly { provider: string; id: string }[];
  priorityRefs?: readonly { provider: string; id: string }[];
}): string[] | undefined {
  const providers = new Set<string>();
  for (const provider of params.providerFilter ?? []) {
    const normalized = normalizeProviderId(provider);
    if (normalized) {
      providers.add(normalized);
    }
  }
  for (const ref of params.explicitRefs) {
    providers.add(ref.provider);
  }
  for (const ref of params.priorityRefs ?? []) {
    providers.add(ref.provider);
  }
  return providers.size > 0
    ? [...providers].toSorted((left, right) => left.localeCompare(right))
    : undefined;
}

export function applyLiveProviderPluginDiscoveryCompat(params: {
  config: OpenClawConfig;
  providers: readonly string[] | undefined;
  env?: NodeJS.ProcessEnv;
}): OpenClawConfig {
  const pluginIds = new Set<string>();
  for (const provider of params.providers ?? []) {
    const owners =
      resolveOwningPluginIdsForProviderRef({
        provider,
        config: params.config,
        env: params.env,
      }) ?? [];
    if (owners.length === 0) {
      pluginIds.add(provider);
      continue;
    }
    for (const owner of owners) {
      pluginIds.add(owner);
    }
  }
  if (pluginIds.size === 0) {
    return params.config;
  }
  const orderedPluginIds = [...pluginIds].toSorted((left, right) => left.localeCompare(right));
  const compatConfig =
    withBundledPluginEnablementCompat({
      config: params.config,
      pluginIds: orderedPluginIds,
    }) ?? params.config;
  const entries = { ...compatConfig.plugins?.entries };
  const allow = new Set(compatConfig.plugins?.allow ?? []);
  for (const pluginId of orderedPluginIds) {
    allow.add(pluginId);
    entries[pluginId] ??= { enabled: true };
  }
  return {
    ...compatConfig,
    plugins: {
      ...compatConfig.plugins,
      enabled: true,
      allow: [...allow].toSorted((left, right) => left.localeCompare(right)),
      entries,
    },
  };
}

/**
 * Append prioritized dynamic live models that are not already present.
 *
 * Provider hooks can prepare credentials/session state, resolve the current
 * model metadata, and then pass through the same model normalizer used by agent
 * discovery so downstream catalog code sees one canonical shape.
 */
export async function appendPrioritizedDynamicLiveModels(params: {
  models: Model[];
  config?: OpenClawConfig;
  agentDir: string;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
  modelRegistry: ProviderResolveDynamicModelContext["modelRegistry"];
  resolveDynamicModel?: DynamicModelResolver;
  prepareDynamicModel?: DynamicModelPreparer;
  normalizeModel?: DynamicModelNormalizer;
  refs?: Array<{ provider: string; id: string }>;
}): Promise<{ models: Model[]; added: Model[] }> {
  const resolveDynamicModel = params.resolveDynamicModel ?? runProviderDynamicModelDefault;
  const prepareDynamicModel = params.prepareDynamicModel ?? prepareProviderDynamicModelDefault;
  const refs = params.refs ?? listPrioritizedHighSignalLiveModelRefs();
  const seen = new Set<string>();
  for (const model of params.models) {
    const key = liveModelKey(model.provider, model.id);
    if (key) {
      seen.add(key);
    }
  }

  const models = [...params.models];
  const added: Model[] = [];
  for (const ref of refs) {
    const requestedKey = liveModelKey(ref.provider, ref.id);
    if (!requestedKey || seen.has(requestedKey)) {
      continue;
    }
    const providerConfig = findNormalizedProviderValue(
      params.config?.models?.providers,
      ref.provider,
    );
    // Dynamic model hooks receive the originally requested provider/id so they
    // can map aliases or live service identifiers before returning a catalog row.
    const context = {
      config: params.config,
      agentDir: params.agentDir,
      workspaceDir: params.workspaceDir,
      provider: ref.provider,
      modelId: ref.id,
      modelRegistry: params.modelRegistry,
      providerConfig,
    };
    const prepared = await prepareDynamicModel({
      provider: ref.provider,
      config: params.config,
      workspaceDir: params.workspaceDir,
      env: params.env,
      context,
    });
    const resolved =
      prepared ??
      (await resolveDynamicModel({
        provider: ref.provider,
        config: params.config,
        workspaceDir: params.workspaceDir,
        env: params.env,
        context,
      }));
    if (!resolved) {
      continue;
    }
    const model = params.normalizeModel
      ? await params.normalizeModel(resolved as Model, params.agentDir)
      : await normalizeDynamicModelDefault(resolved as Model, params.agentDir, {
          config: params.config,
          workspaceDir: params.workspaceDir,
        });
    const resolvedKey = liveModelKey(model.provider, model.id);
    // De-dupe against the resolved identity as well as the requested ref; hooks
    // may canonicalize provider ids or return aliases.
    if (!resolvedKey || seen.has(resolvedKey)) {
      continue;
    }
    seen.add(resolvedKey);
    models.push(model);
    added.push(model);
  }
  return { models, added };
}
