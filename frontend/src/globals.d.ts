export {};

declare global {
    interface ImportMeta {
        readonly env: {
            [key: string]: string | boolean | undefined;
            VITE_DEPLOY_MODE?: string;
            GIT_REV?: string;
        };
    }
}

