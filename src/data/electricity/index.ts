import type { ElectricityTariffs, TariffValidation } from "@/domain";
import generated from "./tariffs.generated.json";
import validation from "./validation.generated.json";

/**
 * The committed tariff dataset, typed. Written only by `scripts/fetch-electricity-tariffs.mjs`
 * (run by hand), never by the running site: no GlobalPetrolPrices host is reached at runtime.
 * The read day and the venue's quarter label travel with every figure derived from it.
 */
export const ELECTRICITY_TARIFFS: ElectricityTariffs = generated as ElectricityTariffs;

/**
 * How far the committed rows sit from Eurostat and the EIA, written only by
 * `npm run tariffs:validate -- --write` with each tariff refresh. The page quotes the medians
 * beside the day they were measured.
 */
export const TARIFF_VALIDATION: TariffValidation = validation as TariffValidation;
