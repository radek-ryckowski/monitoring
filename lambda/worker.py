import json
import time
from datetime import datetime

def handler(event, context):
    print(f'Worker processing started: {json.dumps(event)}')

    # Simulate some work
    time.sleep(0.1)

    return {
        'statusCode': 200,
        'body': json.dumps({
            'message': 'Worker task completed',
            'timestamp': datetime.now().isoformat(),
            'processed_items': len(event.get('items', []))
        })
    }
