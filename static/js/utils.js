const Utils = {
    calcularDiaHidrologico: function(fechaISO) {
        let d = new Date(fechaISO);
        let hora = d.getHours();
        if (hora < 7) { d.setDate(d.getDate() - 1); }
        return d.toISOString().split('T')[0];
    },
    formatDate: function(date) { return date.toISOString().split('T')[0]; }
};