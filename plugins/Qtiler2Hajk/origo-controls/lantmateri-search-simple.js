// Ultra-simple test control
console.log('[DEBUG] Simple control script loaded');

(function(window) {
  console.log('[DEBUG] Inside IIFE');
  
  function LantmateriSearch(options) {
    console.log('[DEBUG] LantmateriSearch constructor called');
    options = options || {};
    
    return {
      onInit: function(viewerInstance) {
        console.log('[DEBUG] LantmateriSearch onInit called');
      },
      render: function() {
        console.log('[DEBUG] LantmateriSearch render called');
        return document.createElement('div');
      }
    };
  }
  
  window.LantmateriSearch = LantmateriSearch;
  console.log('[DEBUG] LantmateriSearch registered to window');
})(window);
