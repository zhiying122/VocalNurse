/**
 * 數據視覺化：疼痛趨勢圖 + 給藥時間軸
 */

let painChart = null;

// 模擬歷史資料（實際會從後端取得）
const painHistory = [
    { time: '07:00', score: 3 },
    { time: '09:00', score: 5 },
    { time: '11:00', score: 4 },
    { time: '13:00', score: 2 },
];

const medicationHistory = [
    { time: '07:30', drug: 'Acetaminophen 500mg PO', danger: false },
    { time: '09:15', drug: 'Voltaren 25mg PO (PRN)', danger: false },
    { time: '11:00', drug: '傷口換藥', danger: false },
];

/**
 * 初始化疼痛趨勢圖
 */
function initPainChart() {
    const ctx = document.getElementById('pain-chart').getContext('2d');

    if (painChart) painChart.destroy();

    painChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: painHistory.map(p => p.time),
            datasets: [{
                label: 'Pain Scale',
                data: painHistory.map(p => p.score),
                borderColor: '#c62828',
                backgroundColor: 'rgba(198, 40, 40, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 6,
                pointBackgroundColor: painHistory.map(p =>
                    p.score >= 7 ? '#c62828' : p.score >= 4 ? '#f57c00' : '#388e3c'
                ),
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    min: 0, max: 10,
                    title: { display: true, text: '疼痛指數' },
                    ticks: { stepSize: 1 },
                },
                x: {
                    title: { display: true, text: '時間' },
                }
            },
            plugins: {
                legend: { display: false },
            }
        }
    });
}

/**
 * 新增疼痛資料點
 */
function addPainDataPoint(time, score) {
    painHistory.push({ time, score });
    if (painChart) {
        painChart.data.labels.push(time);
        painChart.data.datasets[0].data.push(score);
        painChart.data.datasets[0].pointBackgroundColor.push(
            score >= 7 ? '#c62828' : score >= 4 ? '#f57c00' : '#388e3c'
        );
        painChart.update();
    }
}

/**
 * 渲染給藥時間軸
 */
function renderTimeline() {
    const container = document.getElementById('medication-timeline');
    container.innerHTML = medicationHistory.map(item => `
        <div class="timeline-item ${item.danger ? 'danger' : ''}">
            <span class="timeline-time">${item.time}</span>
            <span class="timeline-content">${item.drug}</span>
        </div>
    `).join('');
}

/**
 * 新增時間軸事件
 */
function addTimelineEvent(time, drug, danger = false) {
    medicationHistory.push({ time, drug, danger });
    renderTimeline();
}

// 頁面載入時初始化
document.addEventListener('DOMContentLoaded', () => {
    initPainChart();
    renderTimeline();
});
