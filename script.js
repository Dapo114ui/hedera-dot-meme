document.addEventListener('DOMContentLoaded', () => {
      const connectWalletBtn = document.getElementById('connectWalletBtn');
      const walletModal = document.getElementById('walletModal');
      if (connectWalletBtn && walletModal) {
                connectWalletBtn.addEventListener('click', () => { walletModal.classList.add('active'); });
      }
      // Dropdown Logic
                              const tradeDropdownBtn = document.getElementById('tradeDropdownBtn');
      const tradeDropdownMenu = document.getElementById('tradeDropdownMenu');
      if (tradeDropdownBtn && tradeDropdownMenu) {
                tradeDropdownBtn.addEventListener('click', (e) => { e.preventDefault(); tradeDropdownMenu.classList.toggle('active'); });
      }
});
