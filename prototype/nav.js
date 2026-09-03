/**
 * Dues Management System - Prototype Navigation
 * Connects all HTML pages via simple JS routing.
 */

function navigateTo(page) {
  if (page && page.trim()) {
    window.location.href = page;
  }
}

// Highlight active nav link based on current page
document.addEventListener('DOMContentLoaded', function () {
  var currentPage = window.location.pathname.split('/').pop() || 'index.html';
  var links = document.querySelectorAll('.sidebar-nav a, .nav-link');
  links.forEach(function (link) {
    var href = link.getAttribute('href');
    if (href === currentPage) {
      link.classList.add('active');
    }
  });
});
