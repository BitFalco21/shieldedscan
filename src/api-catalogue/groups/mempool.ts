import type { ApiGroup } from "../types";

export const MEMPOOL_GROUP: ApiGroup = {
  id: "mempool",
  label: "Mempool",
  endpoints: [
    {
      id: "mempool-summary",
      method: "GET",
      path: "/v1/mempool/summary",
      title: "Mempool summary",
      description:
        "Pending count, size, median fee rate, and the privacy mix of a stated sample, as counts beside the sample size — never a percentage, never extrapolated.",
      params: [],
      exampleResponse: `{
  "pendingCount": 347,
  "totalSizeBytes": 812340,
  "medianFeeZat": 30000,
  "medianFeeRateZatPerByte": 24.6,
  "composition": {
    "coverage": { "basis": "sample", "sampled": 100, "population": 347, "extrapolated": false },
    "transparent": 61,
    "mixed": 24,
    "shielded": 15
  },
  "asOf": 1753795200
}`,
    },
  ],
};
