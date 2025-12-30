document.addEventListener('DOMContentLoaded', () => {
    
    // 1. Scroll Reveal Animation
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.reveal-up').forEach(el => observer.observe(el));

    // 2. Count Up Animation for KPIs
    document.querySelectorAll('.count-up').forEach(el => {
        const target = parseInt(el.innerText);
        let count = 0;
        const duration = 1500;
        const increment = target / (duration / 16); // 60fps
        
        if(isNaN(target)) return;
        el.innerText = '0';
        
        const timer = setInterval(() => {
            count += increment;
            if (count >= target) {
                el.innerText = target;
                clearInterval(timer);
            } else {
                el.innerText = Math.floor(count);
            }
        }, 16);
    });

    // 3. Search Filter (Frontend)
    const searchInput = document.getElementById('tableSearch');
    if (searchInput) {
        searchInput.addEventListener('keyup', (e) => {
            const term = e.target.value.toLowerCase();
            document.querySelectorAll('tbody tr').forEach(row => {
                const text = row.innerText.toLowerCase();
                row.style.display = text.includes(term) ? '' : 'none';
            });
        });
    }

    // 4. Toast Notification Logic
    // Vérifie s'il y a un param URL ?msg=...
    const urlParams = new URLSearchParams(window.location.search);
    const msg = urlParams.get('msg');
    if (msg) {
        showToast(msg.replace(/_/g, ' '), 'success');
        // Nettoie l'URL
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    // Animation Bouton Form
    document.querySelectorAll('form').forEach(form => {
        form.addEventListener('submit', (e) => {
            const btn = form.querySelector('button[type="submit"]');
            if(btn) {
                btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Traitement...';
                btn.disabled = true;
            }
        });
    });
});

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return; // Should exist in layout
    
    const toast = document.createElement('div');
    toast.className = `toast-premium show`;
    toast.innerHTML = `<i class="bi bi-check-circle-fill text-primary"></i> ${message}`;
    
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}
