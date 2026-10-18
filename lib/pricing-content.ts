export const billingSteps = [
  { title: "Add balance", description: "Choose an amount and add funds to your account." },
  { title: "Make API requests", description: "Use one API key to send requests to your chosen models." },
  { title: "Pay based on actual token usage", description: "Each request uses balance based on its input and output tokens." },
] as const;

export const pricingFAQs = [
  {
    id: "usage",
    question: "How is usage calculated?",
    answer: "Input and output tokens are counted separately. Each count is multiplied by the model's price per 1M tokens, then the two costs are added to calculate the request cost.",
  },
  {
    id: "balance",
    question: "Do balances expire?",
    answer: "Balance validity will be explained in the billing terms before you add funds. An expiration policy has not been set for this preview.",
  },
  {
    id: "subscription",
    question: "Is there a subscription fee?",
    answer: "No. Token Depot uses pay-as-you-go pricing with no monthly or annual subscription and no minimum spend. Add balance and pay only for API usage.",
  },
  {
    id: "token-pricing",
    question: "How are input and output tokens priced?",
    answer: "Input tokens are the content you send to a model. Output tokens are the content it generates. Each model has separate rates for both, listed in CNY per 1M tokens in the table above.",
  },
  {
    id: "multiple-models",
    question: "Can I use multiple models with one API key?",
    answer: "Yes. Use the same API key and change the model ID in your request to switch between available models. Each request uses the rates for the model you choose.",
  },
] as const;
