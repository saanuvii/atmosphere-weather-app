from flask import Flask, render_template, request, jsonify
import requests
from datetime import datetime, timezone, timedelta
from config import Config

app = Flask(__name__)
app.config.from_object(Config)

Config.validate()

def format_timestamp(ts, tz_offset, fmt='%I:%M %p'):
    """Converts a Unix timestamp and timezone offset into a formatted string."""
    utc_time = datetime.fromtimestamp(ts, tz=timezone.utc)
    local_time = utc_time + timedelta(seconds=tz_offset)
    return local_time.strftime(fmt)

def process_weather_data(data):
    """Extracts and sanitizes current weather data."""
    tz_offset = data.get('timezone', 0)
    return {
        'city': data.get('name'),
        'country': data.get('sys', {}).get('country'),
        'lat': data.get('coord', {}).get('lat'),
        'lon': data.get('coord', {}).get('lon'),
        'temp': round(data.get('main', {}).get('temp')),
        'temp_min': round(data.get('main', {}).get('temp_min')),
        'temp_max': round(data.get('main', {}).get('temp_max')),
        'feels_like': round(data.get('main', {}).get('feels_like')),
        'humidity': data.get('main', {}).get('humidity'),
        'pressure': data.get('main', {}).get('pressure'),
        'wind_speed': round(data.get('wind', {}).get('speed') * 3.6, 1),
        'description': data.get('weather', [{}])[0].get('description', '').title(),
        'icon': data.get('weather', [{}])[0].get('icon', '01d'),
        'sunrise': format_timestamp(data.get('sys', {}).get('sunrise', 0), tz_offset),
        'sunset': format_timestamp(data.get('sys', {}).get('sunset', 0), tz_offset),
        'date': datetime.now().strftime('%A, %B %d, %Y')
    }

def process_advanced_forecast(data):
    """Extracts a guaranteed rolling 24-hour block and compiles subsequent calendar days."""
    list_data = data.get('list', [])
    
    # 1. Compile the immediate rolling 24-hour timeline (8 steps * 3 hours)
    hourly_rolling = []
    for item in list_data[:8]:
        dt_txt = item.get('dt_txt', '')
        time_label = datetime.strptime(dt_txt, '%Y-%m-%d %H:%M:%S').strftime('%I:%M %p')
        hourly_rolling.append({
            'time': time_label,
            'temp': round(item.get('main', {}).get('temp')),
            'description': item.get('weather', [{}])[0].get('description', '').capitalize(),
            'icon': item.get('weather', [{}])[0].get('icon', '01d'),
            'humidity': item.get('main', {}).get('humidity'),
            'wind': round(item.get('wind', {}).get('speed') * 3.6, 1)
        })

    # 2. Group the full list into standard calendar days for the daily projection cards
    grouped_days = {}
    for item in list_data:
        dt_txt = item.get('dt_txt', '')
        date_str = dt_txt.split(' ')[0]
        dt_obj = datetime.strptime(date_str, '%Y-%m-%d')
        day_name = dt_obj.strftime('%a')
        display_date = dt_obj.strftime('%B %d')

        if date_str not in grouped_days:
            grouped_days[date_str] = {
                'day_name': day_name,
                'display_date': display_date,
                'date_key': date_str,
                'hourly_intervals': []
            }
        
        time_label = datetime.strptime(dt_txt, '%Y-%m-%d %H:%M:%S').strftime('%I:%M %p')
        grouped_days[date_str]['hourly_intervals'].append({
            'time': time_label,
            'temp': round(item.get('main', {}).get('temp')),
            'description': item.get('weather', [{}])[0].get('description', '').capitalize(),
            'icon': item.get('weather', [{}])[0].get('icon', '01d'),
            'humidity': item.get('main', {}).get('humidity'),
            'wind': round(item.get('wind', {}).get('speed') * 3.6, 1)
        })

    return {
        'hourly_rolling': hourly_rolling,
        'calendar_days': list(grouped_days.values())[:5]
    }

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/weather', methods=['GET'])
def get_weather():
    city = request.args.get('city', '').strip()
    lat = request.args.get('lat')
    lon = request.args.get('lon')
    units = request.args.get('units', 'metric')

    if not city and not (lat and lon):
        return jsonify({'error': 'Please provide a valid location search.'}), 400

    api_key = app.config['OPENWEATHER_API_KEY']
    base_url = app.config['BASE_URL']

    try:
        if lat and lon:
            weather_params = {'lat': lat, 'lon': lon, 'appid': api_key, 'units': units}
        else:
            weather_params = {'q': city, 'appid': api_key, 'units': units}

        weather_res = requests.get(f"{base_url}weather", params=weather_params, timeout=10)
        if weather_res.status_code == 404:
            return jsonify({'error': 'City not found. Please verify spelling.'}), 404
        weather_res.raise_for_status()
        weather_data = weather_res.json()

        current_payload = process_weather_data(weather_data)
        resolved_lat = current_payload['lat']
        resolved_lon = current_payload['lon']

        # Fetch grouped forecast arrays
        forecast_params = {'lat': resolved_lat, 'lon': resolved_lon, 'appid': api_key, 'units': units}
        forecast_res = requests.get(f"{base_url}forecast", params=forecast_params, timeout=10)
        forecast_res.raise_for_status()
        forecast_payload = process_advanced_forecast(forecast_res.json())

        # Fetch pollution indexes
        pollution_url = "https://api.openweathermap.org/data/2.5/air_pollution"
        pollution_res = requests.get(pollution_url, params={'lat': resolved_lat, 'lon': resolved_lon, 'appid': api_key}, timeout=10)
        pollution_res.raise_for_status()
        pollution_data = pollution_res.json()
        
        aqi_index = pollution_data.get('list', [{}])[0].get('main', {}).get('aqi', 1)
        mock_uv = round(max(1.0, 11.0 - (weather_data.get('clouds', {}).get('all', 0) / 10)), 1)

        return jsonify({
            'current': current_payload,
            'forecast': forecast_payload,
            'indexes': {
                'aqi': aqi_index,
                'uv': mock_uv
            }
        })

    except requests.exceptions.RequestException:
        return jsonify({'error': 'Failed to connect to the weather network.'}), 502
    except Exception:
        return jsonify({'error': 'An internal data processing error occurred.'}), 500

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)