export type MatterDeadline = {
  matterId: string;
  clientEmail: string;
  deadline: string;
  status: "open" | "closed";
};

export type DeadlineFollowup = {
  matterId: string;
  clientEmail: string;
  daysRemaining: number;
  urgency: "due-today" | "due-soon";
};

export function selectDeadlineFollowups(
  matters: MatterDeadline[],
  asOf: string,
  windowDays = 3,
): DeadlineFollowup[] {
  const today = Date.parse(`${asOf}T00:00:00Z`);
  return matters.flatMap((matter) => {
    if (matter.status !== "open") return [];
    const daysRemaining = Math.round(
      (Date.parse(`${matter.deadline}T00:00:00Z`) - today) / 86_400_000,
    );
    if (daysRemaining < 0 || daysRemaining > windowDays) return [];
    return [{
      matterId: matter.matterId,
      clientEmail: matter.clientEmail,
      daysRemaining,
      urgency: daysRemaining === 0 ? "due-today" : "due-soon",
    }];
  });
}
