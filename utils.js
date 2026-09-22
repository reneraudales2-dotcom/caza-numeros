// utils.js - funciones auxiliares reutilizables

/**
 * Debounce: ejecuta la función después de que haya transcurrido `wait` ms sin nuevas invocaciones.
 */
export function debounce(func, wait) {
  let timeout;
  return function (...args) {
    const later = () => {
      timeout = null;
      func.apply(this, args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Genera un ID corto aleatorio (para mensajes, etc.)
 */
export function generateId(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Formatea milisegundos en una cadena legible (e.g., 1234 -> '1.23s')
 */
export function formatMs(ms) {
  return (ms / 1000).toFixed(2) + 's';
}
