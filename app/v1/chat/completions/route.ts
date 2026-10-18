import { handleChatCompletion } from "@/lib/ai/gateway";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: Request) { return handleChatCompletion(request); }
