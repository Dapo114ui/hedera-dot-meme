const STORAGE_KEY = 'onyc_watchlist';

function readAll() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
        return [];
    }
}

function writeAll(addresses) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(addresses));
    } catch (e) {
        console.warn('Could not save watchlist (localStorage full?)', e);
    }
}

export function getWatchlist() {
    return readAll();
}

export function isWatchlisted(address) {
    return readAll().includes(address.toLowerCase());
}

// Returns the new state (true = now watchlisted, false = now removed)
export function toggleWatchlist(address) {
    const addr = address.toLowerCase();
    const current = readAll();
    const idx = current.indexOf(addr);
    if (idx === -1) {
        current.push(addr);
        writeAll(current);
        return true;
    }
    current.splice(idx, 1);
    writeAll(current);
    return false;
}
