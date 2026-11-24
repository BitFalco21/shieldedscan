/**
 * How many rows each homepage panel holds. The route asks the API for these, and the live panels
 * fall back to them when the server render could not read a list, so a panel cached as
 * unavailable fills from the next poll instead of staying empty until a reload.
 */
export const HOME_LIMITS = { blocks: 8, transactions: 8, transfers: 4 } as const;
