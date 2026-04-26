/**
 * 疼痛趨勢圖（Chart.js）
 */
let painChart = null;

function initPainChart() {
    const ctx = document.getElementById('pain-chart');
    if (!ctx) return;
    if (painChart) painChart.destroy();

    painChart = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Pain Scale',
                data: [],
                borderColor: '#c62828',
                backgroundColor: 'rgba(198,40,40,0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 6,
                pointBackgroundColor: [],
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: { min: 0, max: 10, title: { display: true, text: '疼痛指數' }, ticks: { stepSize: 2 } },
                x: { title: { display: true, text: '時間' } },
            },
            plugins: { legend: { display: false } },
        }
    });
}

function updatePainChart() {
    if (!painChart || !currentPatient) return;
    const records = allRecords[currentPatient.id].filter(r => r.pain_scale != null);

    painChart.data.labels = records.map(r => r.time);
    painChart.data.datasets[0].data = records.map(r => r.pain_scale);
    painChart.data.datasets[0].pointBackgroundColor = records.map(r =>
        r.pain_scale >= 7 ? '#c62828' : r.pain_scale >= 4 ? '#f57c00' : '#388e3c'
    );
    painChart.update();
}

/**
 * 給藥時間軸（Chart.js scatter chart）
 */
let medTimeline = null;

function initMedicationTimeline() {
    const ctx = document.getElementById('med-timeline');
    if (!ctx) return;
    if (medTimeline) medTimeline.destroy();

    medTimeline = new Chart(ctx.getContext('2d'), {
        type: 'scatter',
        data: {
            datasets: [{
                label: '給藥紀錄',
                data: [],
                pointRadius: 8,
                pointBackgroundColor: [],
                pointBorderColor: [],
                pointBorderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: '時間' },
                    ticks: {
                        callback: function(value) {
                            const h = Math.floor(value);
                            const m = Math.round((value - h) * 60);
                            return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`;
                        }
                    },
                    min: 0,
                    max: 24
                },
                y: {
                    type: 'linear',
                    title: { display: true, text: '藥物' },
                    ticks: { display: false },
                    min: -1,
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const d = context.raw;
                            return `${d.drugName} ${d.dose||''} ${d.unit||''} ${d.route||''} @ ${d.timeStr}`;
                        }
                    }
                }
            }
        }
    });
}

function updateMedicationTimeline(records, alerts) {
    const emptyEl = document.getElementById('med-timeline-empty');
    const canvasEl = document.getElementById('med-timeline');
    if (!canvasEl) return;

    const events = [];
    const alertItems = new Set((alerts || []).map(a => a.item));

    if (records && records.length) {
        let drugIndex = 0;
        const drugMap = {};

        for (const record of records) {
            if (!record.medications) continue;
            for (const med of record.medications) {
                if (!(med.name in drugMap)) {
                    drugMap[med.name] = drugIndex++;
                }
                const timeParts = (record.time || '00:00').split(':');
                const timeNum = parseInt(timeParts[0]) + parseInt(timeParts[1] || 0) / 60;

                const hasAlert = alertItems.has(med.name) ||
                    (record.alerts || []).some(a => a.item === med.name);

                events.push({
                    x: timeNum,
                    y: drugMap[med.name],
                    drugName: med.name,
                    dose: med.dose || '',
                    unit: med.unit || '',
                    route: med.route || '',
                    timeStr: record.time,
                    hasAlert: hasAlert
                });
            }
        }
    }

    if (events.length === 0) {
        if (emptyEl) emptyEl.style.display = '';
        canvasEl.style.display = 'none';
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    canvasEl.style.display = '';

    if (!medTimeline) initMedicationTimeline();

    medTimeline.data.datasets[0].data = events;
    medTimeline.data.datasets[0].pointBackgroundColor = events.map(e => e.hasAlert ? '#c62828' : '#2d3a8c');
    medTimeline.data.datasets[0].pointBorderColor = events.map(e => e.hasAlert ? '#c62828' : '#2d3a8c');
    medTimeline.update();
}

// ES Module exports for testing (conditional to preserve browser compatibility)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initPainChart,
    updatePainChart,
    initMedicationTimeline,
    updateMedicationTimeline,
  };
}
