const STORAGE_KEY = 'onyc_price_alerts';

function readAll() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
        return [];
    }
}

function writeAll(alerts) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
    } catch (e) {
        console.warn('Could not save price alerts (localStorage full?)', e);
    }
}

function makeId() {
    return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
}

// Active (untriggered) alerts for a token, newest first.
export function getAlertsForToken(tokenAddress) {
    const addr = tokenAddress.toLowerCase();
    return readAll()
        .filter(a => a.tokenAddress === addr && !a.triggered)
        .sort((a, b) => b.createdAt - a.createdAt);
}

export function addAlert(tokenAddress, targetPrice, direction) {
    const alerts = readAll();
    const alert = {
        id: makeId(),
        tokenAddress: tokenAddress.toLowerCase(),
        targetPrice,
        direction, // 'above' or 'below'
        triggered: false,
        createdAt: Date.now()
    };
    alerts.push(alert);
    writeAll(alerts);
    return alert;
}

export function removeAlert(id) {
    writeAll(readAll().filter(a => a.id !== id));
}

// Checks current price against this token's active alerts. Any that just
// crossed their target are marked triggered (so they don't fire again) and
// returned to the caller to display.
export function checkAlerts(tokenAddress, currentPrice) {
    const addr = tokenAddress.toLowerCase();
    const alerts = readAll();
    const justTriggered = [];
    let changed = false;

    for (const a of alerts) {
        if (a.tokenAddress !== addr || a.triggered) continue;
        const hit = a.direction === 'above' ? currentPrice >= a.targetPrice : currentPrice <= a.targetPrice;
        if (hit) {
            a.triggered = true;
            justTriggered.push(a);
            changed = true;
        }
    }

    if (changed) writeAll(alerts);
    return justTriggered;
}
