export function getConfig() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error('DATABASE_URL is required');
    }

    return {
        databaseUrl,
        port: parseInt(process.env.PORT || '3000'),
        host: process.env.HOST || '0.0.0.0'
    };
}

