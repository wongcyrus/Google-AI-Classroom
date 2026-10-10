export const formatBytes = (bytes, decimals = 2) => {
    const num = Number(bytes);
    if (!bytes || isNaN(num) || num <= 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    if (i <= 0) {
        return `${Math.round(bytes)} Bytes`;
    }

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

export const formatAiCost = (amount) => {
    if (amount === undefined || amount === null || isNaN(amount)) return '$0.00';
    const num = Number(amount);
    if (num === 0) return '$0.00';
    if (num < 0.01) {
        // High precision formatting for micro-transactions (e.g. $0.0038)
        return `$${num.toFixed(4)}`;
    }
    return `$${num.toFixed(2)}`;
};

export const calculateStorageCost = (bytes, ratePerGibMonth = 0.023) => {
    if (!bytes || bytes <= 0 || isNaN(bytes)) return 0;
    const gib = Number(bytes) / (1024 * 1024 * 1024);
    return gib * Number(ratePerGibMonth || 0.023);
};

export const formatStorageCost = (bytes, ratePerGibMonth = 0.023, customDecimals = null) => {
    const cost = calculateStorageCost(bytes, ratePerGibMonth);
    if (cost === 0) return '$0.00';
    if (customDecimals !== null) {
        return `$${cost.toFixed(customDecimals)}`;
    }
    if (cost < 0.01) {
        return `$${cost.toFixed(4)}`;
    }
    if (cost < 1) {
        const str3 = cost.toFixed(3);
        return str3.endsWith('0') ? `$${cost.toFixed(2)}` : `$${str3}`;
    }
    return `$${cost.toFixed(2)}`;
};
