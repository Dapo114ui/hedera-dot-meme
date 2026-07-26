// Replaces native alert()/confirm() with the same styled modal already used
// for the launch-success message (see .modal-overlay/.modal-content/etc in
// style.css) - built once here and reused on every page, instead of every
// call site blocking on the browser's own unstyled dialog.

const VARIANT_STYLE = {
    info: { icon: 'ℹ️', border: '#FFD700', shadow: 'rgba(253, 224, 48, 0.2)' },
    success: { icon: '🚀', border: '#10b981', shadow: 'rgba(16, 185, 129, 0.2)' },
    error: { icon: '⚠️', border: '#ef4444', shadow: 'rgba(239, 68, 68, 0.2)' },
    warning: { icon: '⚠️', border: '#FFD700', shadow: 'rgba(253, 224, 48, 0.2)' }
};

let overlay = null;

function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-content">
            <div class="modal-icon"></div>
            <h2 class="modal-title"></h2>
            <p class="modal-text"></p>
            <div class="modal-actions"></div>
        </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
}

function render(variant, title, message) {
    const el = ensureOverlay();
    const style = VARIANT_STYLE[variant] || VARIANT_STYLE.info;
    const content = el.querySelector('.modal-content');
    content.style.borderColor = style.border;
    content.style.boxShadow = `0 10px 30px ${style.shadow}`;
    el.querySelector('.modal-icon').textContent = style.icon;
    el.querySelector('.modal-title').textContent = title;
    el.querySelector('.modal-text').textContent = message;
    return el;
}

function open(el) {
    requestAnimationFrame(() => el.classList.add('active'));
}

function close(el) {
    el.classList.remove('active');
}

// Fire-and-forget notification - matches alert()'s one-button shape.
// Resolves once the user dismisses it, in case a caller wants to wait.
export function showAlert(message, { title = 'Notice', variant = 'info' } = {}) {
    return new Promise(resolve => {
        const el = render(variant, title, message);
        const actions = el.querySelector('.modal-actions');
        actions.innerHTML = '';
        const okBtn = document.createElement('button');
        okBtn.className = 'btn-primary';
        okBtn.textContent = 'OK';
        okBtn.onclick = () => { close(el); resolve(); };
        actions.appendChild(okBtn);
        open(el);
    });
}

// Matches confirm()'s boolean-return shape, but async - callers await it.
export function showConfirm(message, { title = 'Please Confirm', variant = 'warning', confirmLabel = 'Confirm', cancelLabel = 'Cancel' } = {}) {
    return new Promise(resolve => {
        const el = render(variant, title, message);
        const actions = el.querySelector('.modal-actions');
        actions.innerHTML = '';
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn-primary';
        confirmBtn.textContent = confirmLabel;
        confirmBtn.onclick = () => { close(el); resolve(true); };
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn-secondary';
        cancelBtn.textContent = cancelLabel;
        cancelBtn.onclick = () => { close(el); resolve(false); };
        actions.appendChild(confirmBtn);
        actions.appendChild(cancelBtn);
        open(el);
    });
}
