import type { SubmitState } from "./actions";

export const initialState: SubmitState = {
  tokenReceived: false,
  success: null,
  reason: null,
  score: null,
  hostname: null,
};
