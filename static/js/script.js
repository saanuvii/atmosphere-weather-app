// Register the Service Worker Middleware Scope
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('Atmosphere Service Worker active on scope:', reg.scope))
            .catch(err => console.error('Service Worker registration failure:', err));
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // UI Elements Selector Mapping
    const searchForm = document.getElementById('search-form');
    const cityInput = document.getElementById('city-input');
    const geoBtn = document.getElementById('geo-btn');
    const themeToggle = document.getElementById('theme-toggle');
    const recentSearchesContainer = document.getElementById('recent-searches');
    const errorAlert = document.getElementById('error-alert');
    const loadingSpinner = document.getElementById('loading-spinner');
    const weatherDashboard = document.getElementById('weather-dashboard');

    const unitCBtn = document.getElementById('unit-c');
    const unitFBtn = document.getElementById('unit-f');

    // State Tracking Properties
    let currentUnits = 'metric'; 
    let lastSearchedQuery = '';  
    let lastGeoCoordinates = null; 
    let cachedForecastDataObject = null; // Caches the complete multi-tier forecast object
    let selectedDayIndex = 0;        
    let weatherChartInstance = null; 

    const AQI_MAP = {
        1: { status: 'Excellent', desc: 'Air quality is pristine and poses no health risks.', badge: 'bg-success' },
        2: { status: 'Fair', desc: 'Acceptable air quality; some minor elements may affect highly sensitive individuals.', badge: 'bg-info text-dark' },
        3: { status: 'Moderate', desc: 'Moderate pollution. Sensitive groups should monitor outdoor time closely.', badge: 'bg-warning text-dark' },
        4: { status: 'Poor', desc: 'Unhealthful conditions. Reduction in heavy prolonged outdoor exertion is recommended.', badge: 'bg-danger' },
        5: { status: 'Hazardous', desc: 'Critical alert levels. Wear filter protection or stay enclosed inside air-conditioned safe spaces.', badge: 'bg-dark text-white' }
    };

    initTheme();
    renderRecentSearches();

    // Event Registration Configurations
    searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const city = cityInput.value.trim();
        if (!city) {
            displayError('Please enter a city name to search.');
            return;
        }
        lastGeoCoordinates = null; 
        lastSearchedQuery = city;
        fetchWeatherData({ city, units: currentUnits });
    });

    geoBtn.addEventListener('click', () => {
        if (!navigator.geolocation) {
            displayError('Geolocation is not supported by your browser.');
            return;
        }
        clearFeedback();
        loadingSpinner.classList.remove('d-none');
        weatherDashboard.classList.add('d-none');

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                lastGeoCoordinates = { lat, lon };
                lastSearchedQuery = '';
                fetchWeatherData({ lat, lon, units: currentUnits });
            },
            () => {
                loadingSpinner.classList.add('d-none');
                displayError('Unable to retrieve your location. Please type manually.');
            }
        );
    });

    unitCBtn.addEventListener('click', () => {
        if (currentUnits === 'metric') return;
        currentUnits = 'metric';
        toggleUnitActiveState();
        reloadWeatherWithUnits();
    });

    unitFBtn.addEventListener('click', () => {
        if (currentUnits === 'imperial') return;
        currentUnits = 'imperial';
        toggleUnitActiveState();
        reloadWeatherWithUnits();
    });

    themeToggle.addEventListener('click', () => {
        const docHtml = document.documentElement;
        const targetTheme = docHtml.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        docHtml.setAttribute('data-theme', targetTheme);
        localStorage.setItem('theme', targetTheme);
        updateThemeToggleIcon(targetTheme);
        
        if (cachedForecastDataObject) {
            evaluateAndBuildChart();
        }
    });

    // Core Async Request Management
    async function fetchWeatherData(params) {
        clearFeedback();
        loadingSpinner.classList.remove('d-none');
        weatherDashboard.classList.add('d-none');

        const queryParams = new URLSearchParams(params);
        try {
            const response = await fetch(`/weather?${queryParams.toString()}`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to capture station metrics.');
            }

            cachedForecastDataObject = data.forecast;
            selectedDayIndex = 0; 
            
            renderCoreDashboard(data.current);
            renderEnvironmentalIndexes(data.indexes);
            renderForecastRow();
            evaluateAndBuildChart();

            if (params.city) saveRecentSearch(params.city);
        } catch (error) {
            displayError(error.message);
        } finally {
            loadingSpinner.classList.add('d-none');
        }
    }

    function reloadWeatherWithUnits() {
        if (lastGeoCoordinates) {
            fetchWeatherData({ ...lastGeoCoordinates, units: currentUnits });
        } else if (lastSearchedQuery) {
            fetchWeatherData({ city: lastSearchedQuery, units: currentUnits });
        }
    }

    // High-Fidelity Data Plot Evaluation Mapping Engine
    function evaluateAndBuildChart() {
        const currentTargetDay = cachedForecastDataObject.calendar_days[selectedDayIndex];
        let chartDataPoints = [];
        let labelContextText = '';

        // If selecting today (index 0) and the remaining future calendar points are low,
        // use the rolling 24-hour timeline array to guarantee a complete line chart.
        if (selectedDayIndex === 0 && currentTargetDay.hourly_intervals.length < 4) {
            chartDataPoints = cachedForecastDataObject.hourly_rolling;
            labelContextText = `Showing consecutive rolling 24-hour forecast trend from current time forward`;
        } else {
            chartDataPoints = currentTargetDay.hourly_intervals;
            labelContextText = `Showing 3-hour projection data parameters for ${currentTargetDay.day_name}, ${currentTargetDay.display_date}`;
        }

        document.getElementById('chart-focused-day').textContent = labelContextText;
        buildLineGraph(chartDataPoints);
    }

    function buildLineGraph(intervalsList) {
        const ctx = document.getElementById('forecastChart').getContext('2d');
        if (weatherChartInstance) weatherChartInstance.destroy();

        const styleConfig = getComputedStyle(document.documentElement);
        const textMainColor = styleConfig.getPropertyValue('--text-primary').trim();
        const textMutedColor = styleConfig.getPropertyValue('--text-muted').trim();
        const gridLinesColor = styleConfig.getPropertyValue('--chart-grid-color').trim();
        const primaryAccent = styleConfig.getPropertyValue('--chart-line-color').trim();

        const timelineLabels = intervalsList.map(h => h.time);
        const temperaturePoints = intervalsList.map(h => h.temp);
        const datasetLabel = currentUnits === 'metric' ? 'Temp (°C)' : 'Temp (°F)';

        weatherChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: timelineLabels,
                datasets: [{
                    label: datasetLabel,
                    data: temperaturePoints,
                    borderColor: primaryAccent,
                    backgroundColor: 'transparent',
                    borderWidth: 3,
                    pointBackgroundColor: primaryAccent,
                    pointHoverBackgroundColor: textMainColor,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    tension: 0.35
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: textMutedColor, font: { weight: '600', size: 11 } }
                    },
                    y: {
                        grid: { color: gridLinesColor },
                        ticks: { color: textMutedColor, font: { size: 11 } }
                    }
                }
            }
        });
    }

    // UI Content Presenters
    function renderCoreDashboard(cur) {
        const unitSymbol = currentUnits === 'metric' ? '°C' : '°F';
        const windUnit = currentUnits === 'metric' ? 'km/h' : 'mph';

        document.getElementById('card-city-name').textContent = cur.city;
        document.getElementById('card-country-badge').textContent = cur.country;
        document.getElementById('card-date').textContent = cur.date;
        document.getElementById('card-temperature').textContent = `${cur.temp}${unitSymbol}`;
        document.getElementById('card-description').textContent = cur.description;
        document.getElementById('card-weather-icon').src = `https://openweathermap.org/img/wn/${cur.icon}@4x.png`;

        document.getElementById('sub-minmax').textContent = `${cur.temp_min}° / ${cur.temp_max}°`;
        document.getElementById('sub-humidity').textContent = `${cur.humidity}%`;
        document.getElementById('sub-wind').textContent = `${cur.wind_speed} ${windUnit}`;
        document.getElementById('sub-pressure').textContent = `${cur.pressure} hPa`;
        
        weatherDashboard.classList.remove('d-none');
    }

    function renderEnvironmentalIndexes(indexes) {
        const aqiLevel = indexes.aqi || 1;
        const aqiMeta = AQI_MAP[aqiLevel] || AQI_MAP[1];
        
        const aqiStatus = document.getElementById('idx-aqi-status');
        const aqiNum = document.getElementById('idx-aqi-num');
        const aqiDesc = document.getElementById('idx-aqi-desc');

        aqiStatus.textContent = aqiMeta.status;
        aqiNum.textContent = `Level ${aqiLevel}`;
        aqiNum.className = `badge rounded-pill px-3 py-2 ${aqiMeta.badge}`;
        aqiDesc.textContent = aqiMeta.desc;

        const uvValue = indexes.uv || 0;
        let uvStatusText = 'Low';
        let uvBadgeClass = 'bg-success text-white';
        let uvSuggestion = 'No protection needed. You can safely stay outside.';

        if (uvValue >= 3 && uvValue < 6) {
            uvStatusText = 'Moderate';
            uvBadgeClass = 'bg-warning text-dark';
            uvSuggestion = 'Protection required. Seek shade during midday solar peaks, wear hats and sunscreen.';
        } else if (uvValue >= 6 && uvValue < 8) {
            uvStatusText = 'High';
            uvBadgeClass = 'bg-danger text-white';
            uvSuggestion = 'High risk of harm. Generous SPF 30+ application, protective clothing, and sunglasses are vital.';
        } else if (uvValue >= 8) {
            uvStatusText = 'Very High / Extreme';
            uvBadgeClass = 'bg-dark text-white border border-danger';
            uvSuggestion = 'Critical solar danger. Avoid direct skin contact exposure fields entirely between 11 AM and 4 PM.';
        }

        const uvStatus = document.getElementById('idx-uv-status');
        const uvNum = document.getElementById('idx-uv-num');
        const uvDesc = document.getElementById('idx-uv-desc');

        uvStatus.textContent = uvStatusText;
        uvNum.textContent = `${uvValue} UV`;
        uvNum.className = `badge rounded-pill px-3 py-2 ${uvBadgeClass}`;
        uvDesc.textContent = uvSuggestion;
    }

    function renderForecastRow() {
        const forecastRow = document.getElementById('forecast-row');
        forecastRow.innerHTML = '';
        const unitSymbol = currentUnits === 'metric' ? '°C' : '°F';

        cachedForecastDataObject.calendar_days.forEach((day, index) => {
            const midIndex = Math.floor(day.hourly_intervals.length / 2);
            const anchorPoint = day.hourly_intervals[midIndex] || day.hourly_intervals[0];
            const activeClass = index === selectedDayIndex ? 'border border-primary' : '';

            const cardHtml = `
                <div class="col">
                    <div class="card card-forecast text-center p-3 h-100 current-day-click-target ${activeClass}" style="cursor:pointer;" data-index="${index}">
                        <p class="mb-0 fw-bold text-custom-primary text-truncate">${day.day_name}</p>
                        <small class="text-custom-muted block mb-1" style="font-size:0.75rem;">${day.display_date}</small>
                        <img src="https://openweathermap.org/img/wn/${anchorPoint.icon}@2x.png" alt="icon" class="weather-forecast-img mx-auto">
                        <p class="mb-0 fs-5 fw-bold text-custom-primary">${anchorPoint.temp}${unitSymbol}</p>
                        <small class="text-custom-muted text-truncate d-block mt-1" style="font-size:0.75rem;">${anchorPoint.description}</small>
                    </div>
                </div>
            `;
            forecastRow.insertAdjacentHTML('beforeend', cardHtml);
        });

        document.querySelectorAll('.current-day-click-target').forEach(card => {
            card.addEventListener('click', function() {
                selectedDayIndex = parseInt(this.getAttribute('data-index'));
                renderForecastRow(); 
                evaluateAndBuildChart();
            });
        });
    }

    // Feedback Management System Helpers
    function displayError(msg) {
        errorAlert.textContent = msg;
        errorAlert.classList.remove('d-none');
    }

    function clearFeedback() {
        errorAlert.classList.add('d-none');
        errorAlert.textContent = '';
    }

    function toggleUnitActiveState() {
        if (currentUnits === 'metric') {
            unitCBtn.classList.add('active');
            unitFBtn.classList.remove('active');
        } else {
            unitFBtn.classList.add('active');
            unitCBtn.classList.remove('active');
        }
    }

    function initTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        updateThemeToggleIcon(savedTheme);
    }

    function updateThemeToggleIcon(theme) {
        const icon = themeToggle.querySelector('i');
        icon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    }

    function saveRecentSearch(city) {
        let history = JSON.parse(localStorage.getItem('weather_history')) || [];
        history = history.filter(item => item.toLowerCase() !== city.toLowerCase());
        history.unshift(city);
        if (history.length > 4) history.pop();
        localStorage.setItem('weather_history', JSON.stringify(history));
        renderRecentSearches();
    }

    // LocalStorage System Presenters
    function renderRecentSearches() {
        const history = JSON.parse(localStorage.getItem('weather_history')) || [];
        recentSearchesContainer.innerHTML = '';

        if (history.length > 0) {
            const label = document.createElement('small');
            label.className = 'text-custom-muted me-1 fw-semibold';
            label.textContent = 'Recent:';
            recentSearchesContainer.appendChild(label);

            history.forEach(city => {
                const tagBtn = document.createElement('button');
                tagBtn.className = 'btn btn-tag';
                tagBtn.textContent = city;
                tagBtn.addEventListener('click', () => {
                    cityInput.value = city;
                    lastGeoCoordinates = null;
                    lastSearchedQuery = city;
                    fetchWeatherData({ city, units: currentUnits });
                });
                recentSearchesContainer.appendChild(tagBtn);
            });
        }
    }
});