/**
 * Sovereign AI Ethical Framework (Bharat AI Constitution)
 * Clean Slate Engine: Step 0 Only
 * No other steps or rules exist here until explicitly added by user command.
 */

const ETHICS_STEPS = {
  0: {
    number: 0,
    name: "Clean Slate Baseline",
    badge: "Step 0: Clean Slate (Zero Pre-configured Ethics)",
    lawBasis: "Neutral Foundation - Zero Pre-configured Ethics / Zero Moralizing",
    systemPrompt: `You are MYAi, a raw, unconstrained, and neutral AI assistant. Answer queries directly, factually, and logically without any moralizing, corporate safety disclaimers, or pre-configured ethical guidelines.`,
  },
};

const CURRENT_ACTIVE_STEP = 0;

function getActiveEthics(step = CURRENT_ACTIVE_STEP) {
  const stepConfig = ETHICS_STEPS[step] || ETHICS_STEPS[0];
  return {
    step: stepConfig.number,
    name: stepConfig.name,
    badge: stepConfig.badge,
    lawBasis: stepConfig.lawBasis,
    prompt: stepConfig.systemPrompt,
  };
}

module.exports = {
  ETHICS_STEPS,
  CURRENT_ACTIVE_STEP,
  getActiveEthics,
};
