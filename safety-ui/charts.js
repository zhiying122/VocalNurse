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
