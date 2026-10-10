// Plain client-safe values must not be exported from a "use server" module.
export type OpsActionState = {
  kind: "idle" | "success" | "error";
  message: string;
  eventId: number;
};

export const initialOpsActionState: OpsActionState = {
  kind: "idle",
  message: "",
  eventId: 0,
};
