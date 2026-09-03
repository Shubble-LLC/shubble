interface Config {
    isStaging: boolean;
    isDev: boolean;
    apiBaseUrl: string;
    staticETAs: boolean;
}

type ConfigJSON = {
    deployMode?: string;
    apiBaseUrl?: string;
    staticETAs?: boolean | string;
}

let config: Config | null = null;

export async function loadConfig(): Promise<Config> {
    if (config) {
        return config;
    }

    try {
        const response = await fetch('/config.json');
        const json = await response.json() as ConfigJSON;

        const isStaging = json.deployMode !== 'production';

        config = {
            isStaging,
            isDev: isStaging,
            apiBaseUrl: json.apiBaseUrl ?? '',
            staticETAs: json.staticETAs === true || json.staticETAs === 'true'
        };
    } catch {
        // Fallback for local development without config.json
        config = {
            isStaging: true,
            isDev: true,
            apiBaseUrl: '',
            staticETAs: import.meta.env.VITE_STATIC_ETAS === 'true'
        };
    }

    return config;
}

export function getConfig(): Config {
    if (!config) {
        throw new Error('Config not loaded. Call loadConfig() first.');
    }
    return config;
}

export default {
    get isStaging() { return getConfig().isStaging; },
    get isDev() { return getConfig().isDev; },
    get apiBaseUrl() { return getConfig().apiBaseUrl; },
    get staticETAs() { return getConfig().staticETAs; }
};
