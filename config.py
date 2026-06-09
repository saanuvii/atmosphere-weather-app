import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'default-secret-key')
    OPENWEATHER_API_KEY = os.environ.get('OPENWEATHER_API_KEY')
    BASE_URL = "https://api.openweathermap.org/data/2.5/"
    
    @classmethod
    def validate(cls):
        if not cls.OPENWEATHER_API_KEY or cls.OPENWEATHER_API_KEY == "your_api_key_here":
            raise ValueError("CRITICAL ERROR: OPENWEATHER_API_KEY is not configured in the .env file.")