const ANTHROPIC_MODEL_ALIASES = [
  {
    id: "tabbit/priority",
    displayName: "Tabbit Priority",
    gatewayModelId: "tabbit/priority",
  },
];

const ANTHROPIC_ALIAS_BY_ID = new Map(
  ANTHROPIC_MODEL_ALIASES.map((entry) => [entry.id, entry]),
);

export function resolveAnthropicModelAlias(model) {
  if (typeof model !== "string") {
    return null;
  }

  return ANTHROPIC_ALIAS_BY_ID.get(model.trim()) || null;
}

export function normalizeAnthropicRequestedModel(model) {
  const alias = resolveAnthropicModelAlias(model);
  return alias ? alias.gatewayModelId : model;
}

function anthropicModelFromAlias(alias) {
  return {
    type: "model",
    id: alias.id,
    display_name: alias.displayName,
    created_at: "2025-01-01T00:00:00Z",
  };
}

export function mapGatewayModelsToOpenAi(models) {
  return {
    object: "list",
    data: models.map((model) => ({
      id: model.id,
      object: "model",
      created: 0,
      owned_by: "tabbit",
      tabbit_display_name: model.tabbit_display_name || model.displayName,
      tabbit_selected_model: model.selectedModel || null,
      supports_images: Boolean(model.supports_images),
      supports_tools: Boolean(model.supports_tools),
      support_thinking: Boolean(model.support_thinking),
      model_access_type: model.model_access_type || null,
      priority_group: model.priority_group || null,
      priority_rank: model.priority_rank || null,
      available_in_tabbit_catalog: Boolean(model.available_in_tabbit_catalog),
    })),
  };
}

export function mapGatewayModelsToAnthropic(_models) {
  return {
    data: ANTHROPIC_MODEL_ALIASES.map(anthropicModelFromAlias),
    has_more: false,
    first_id: ANTHROPIC_MODEL_ALIASES[0]?.id || null,
    last_id:
      ANTHROPIC_MODEL_ALIASES[ANTHROPIC_MODEL_ALIASES.length - 1]?.id || null,
  };
}

export function getAnthropicModelById(modelId) {
  const alias = resolveAnthropicModelAlias(modelId);
  return alias ? anthropicModelFromAlias(alias) : null;
}
