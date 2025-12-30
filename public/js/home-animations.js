document.addEventListener('DOMContentLoaded', () => {
    // Reveal Observer
    const revealCallback = (entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
                // Optionnel: on arrête d'observer après l'animation
                // observer.unobserve(entry.target);
            }
        });
    };

    const options = {
        threshold: 0.15
    };

    const observer = new IntersectionObserver(revealCallback, options);

    document.querySelectorAll('.reveal').forEach(el => {
        observer.observe(el);
    });

    // Navbar scroll effect
    window.addEventListener('scroll', () => {
        const nav = document.querySelector('.premium-nav');
        if (window.scrollY > 50) {
            nav.style.padding = '0.7rem 0';
            nav.style.background = 'rgba(255, 255, 255, 0.9)';
        } else {
            nav.style.padding = '1rem 0';
            nav.style.background = 'rgba(255, 255, 255, 0.7)';
        }
    });
});
