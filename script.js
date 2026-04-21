import './wallet.js';

document.addEventListener('DOMContentLoaded', () => {
    const primaryBtn = document.querySelector('.primary-btn');
    if (primaryBtn) {
        primaryBtn.addEventListener('click', () => {
            alert('Redirecting to trading interface...');
        });
    }

    const secondaryBtn = document.querySelector('.secondary-btn');
    if (secondaryBtn) {
        secondaryBtn.addEventListener('click', () => {
            window.location.href = 'launch.html';
        });
    }

    // Dropdown Logic
    const tradeDropdownBtn = document.getElementById('tradeDropdownBtn');
    const tradeDropdownMenu = document.getElementById('tradeDropdownMenu');

    if (tradeDropdownBtn && tradeDropdownMenu) {
        tradeDropdownBtn.addEventListener('click', (e) => {
            e.preventDefault(); // Prevent jump to top
            tradeDropdownMenu.classList.toggle('active');
        });

        // Close the dropdown if the user clicks outside of it
        document.addEventListener('click', (e) => {
            if (!tradeDropdownBtn.contains(e.target) && !tradeDropdownMenu.contains(e.target)) {
                tradeDropdownMenu.classList.remove('active');
            }
        });
    }
});
