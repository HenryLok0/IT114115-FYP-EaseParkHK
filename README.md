# EaseParkHK

EaseParkHK(泊易香港) is a Flask-based car park vacancy system that provides real-time vacancy information for car parks in various districts of Hong Kong.

## Features

- Real-time vacancy information for car parks in Hong Kong
- Filter car parks by vehicle type
- Display detailed information about car parks, including address, contact information, and website
- Map view to show car park locations

## Project Structure


## Installation and Setup

1. Clone the repository:
    ```sh
    git clone https://github.com/yourusername/easeparkhk.git
    cd easeparkhk
    ```

2. Create and activate a virtual environment:
    ```sh
    python3 -m venv venv
    source venv/bin/activate
    ```

3. Install the required packages:
    ```sh
    pip install -r requirements.txt
    ```

4. Copy `.env.example` to `.env` and fill in your own values. Do not commit `.env`.
    ```sh
    cp .env.example .env
    ```

    - `SECRET_KEY`: a random secret used to sign sessions
    - `SQLALCHEMY_DATABASE_URI`: local SQLite by default, or your own database URL
    - `GEMINI_API_KEY`: Google Gemini API key for the AI chatbox

5. Run the application:
    ```sh
    flask --debug run --host=0.0.0.0
    ```

___

6. Add data to database(make it run):
    ```sh
    python test_data.py
    ```

## Usage

- Open your browser and navigate to `http://localhost:5000` to access the EaseParkHK system.
- Use the navigation bar to select different districts and view real-time car park vacancy information.
- Use the filter options to filter car parks by vehicle type.

## Contributing

Contributions are welcome! Please read the CONTRIBUTING.md for details on how to contribute.

## License

This project is licensed under the MIT License. See the [`LICENSE`](LICENSE ) file for details.
