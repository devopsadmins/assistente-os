import { WebApi, getPersonalAccessTokenHandler } from "azure-devops-node-api";
import type { IRequestHandler } from "azure-devops-node-api/interfaces/common/VsoBaseInterfaces.js";
import { loadConfig, type AssistenteOsConfig } from "./config.js";

let adoConnection: WebApi | null = null;
let adoConfig: AssistenteOsConfig | null = null;

export async function getAdoConnection(config?: AssistenteOsConfig): Promise<WebApi> {
    if (adoConnection && adoConfig) {
        // Check if config changed
        if (
            adoConfig.adoOrg === config?.adoOrg &&
            adoConfig.adoPat === config?.adoPat &&
            adoConfig.adoAuthType === config?.adoAuthType
        ) {
            return adoConnection;
        }
    }

    const cfg = config || loadConfig();

    if (!cfg.adoOrg) {
        throw new Error("Azure DevOps organization not configured. Set AZURE_DEVOPS_ORG or ADO_ORG env var.");
    }

    const orgUrl = `https://dev.azure.com/${cfg.adoOrg}`;
    const authType = cfg.adoAuthType || "pat";

    let authHandler: IRequestHandler;
    if (authType === "pat" && cfg.adoPat) {
        authHandler = getPersonalAccessTokenHandler(cfg.adoPat);
    } else if (authType === "azcli") {
        // Azure CLI auth - uses az account get-access-token
        const { execSync } = await import("node:child_process");
        const token = execSync("az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv", { encoding: "utf8" }).trim();
        authHandler = getPersonalAccessTokenHandler(token);
    } else {
        throw new Error("Interactive auth not implemented. Use PAT or azcli.");
    }

    adoConnection = new WebApi(orgUrl, authHandler);
    adoConfig = cfg;
    return adoConnection;
}

export function getAdoOrg(config?: AssistenteOsConfig): string {
    const cfg = config || loadConfig();
    if (!cfg.adoOrg) {
        throw new Error("Azure DevOps organization not configured. Set AZURE_DEVOPS_ORG or ADO_ORG env var.");
    }
    return cfg.adoOrg;
}