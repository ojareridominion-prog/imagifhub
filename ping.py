import os
import time
import requests
import logging

logger = logging.getLogger(__name__)

def run_pinger(interval=None):
    """
    Ping the app's root endpoint every `interval` seconds.
    Runs indefinitely.
    """
    url = os.environ.get("RENDER_EXTERNAL_URL")
    if not url:
        logger.error("RENDER_EXTERNAL_URL environment variable not set. Pinger stopped.")
        return

    interval = interval or int(os.environ.get("PING_INTERVAL", 300))
    logger.info(f"Pinger started. Pinging {url} every {interval} seconds.")

    while True:
        try:
            resp = requests.get(f"{url}/", timeout=10)
            logger.info(f"Ping sent. Status code: {resp.status_code}")
        except Exception as e:
            logger.error(f"Ping failed: {e}")
        time.sleep(interval)

if __name__ == "__main__":
    # For direct execution as a standalone process
    run_pinger()
