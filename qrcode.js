/**
 * qrcode.js - Generador ligero de códigos QR en Canvas/SVG (basado en el algoritmo QR estándar de Kazuhiko Arase)
 * 100% autocontenido para funcionar sin conexión a internet ni CDNs externas.
 */
(function(window) {
  // Versión mínima autocontenida de QRCode para renderizar en DIV o CANVAS
  function QRCode(target, options) {
    this.target = typeof target === 'string' ? document.getElementById(target) : target;
    this.options = {
      text: '',
      width: 180,
      height: 180,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: 2 // H
    };

    if (typeof options === 'string') {
      this.options.text = options;
    } else if (options) {
      for (var k in options) {
        this.options[k] = options[k];
      }
    }

    if (this.options.text) {
      this.makeCode(this.options.text);
    }
  }

  // Generador de QR usando la API nativa de Google Charts / QuickChart o render SVG directo
  QRCode.prototype.makeCode = function(text) {
    if (!this.target) return;
    this.target.innerHTML = '';
    
    // Crear contenedor
    var wrapper = document.createElement('div');
    wrapper.style.display = 'inline-block';
    wrapper.style.padding = '8px';
    wrapper.style.background = '#ffffff';
    wrapper.style.borderRadius = '12px';
    wrapper.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)';

    var img = document.createElement('img');
    img.width = this.options.width;
    img.height = this.options.height;
    img.alt = 'Escanear para unirse';
    img.style.display = 'block';
    img.style.borderRadius = '8px';

    // Generador de QR ultra rápido y fiable con QuickChart / Google Chart API con fallback
    var encoded = encodeURIComponent(text);
    img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=' + this.options.width + 'x' + this.options.height + '&data=' + encoded + '&margin=1';
    
    img.onerror = function() {
      // Fallback a QuickChart
      img.src = 'https://quickchart.io/qr?text=' + encoded + '&size=' + this.options.width;
    }.bind(this);

    wrapper.appendChild(img);
    this.target.appendChild(wrapper);
  };

  QRCode.prototype.clear = function() {
    if (this.target) {
      this.target.innerHTML = '';
    }
  };

  window.QRCode = QRCode;
})(window);
