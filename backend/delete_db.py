import boto3

# Initialize a DynamoDB client
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('Moose-DDB')  # Replace with your table name

# Function to scan and delete items with PK starting with 'System' and SK equal to 'STATUS'
def delete_items_with_system_prefix_and_status():
    # Initial scan request with both conditions
    response = table.scan(
        FilterExpression='begins_with(PK, :prefix)',
            ExpressionAttributeValues={
                ':prefix': 'Incident',

        }
    )

    # Process the items and delete them
    delete_items(response['Items'])

    # Handle pagination if there are more items (scan can return paginated results)
    while 'LastEvaluatedKey' in response:
        response = table.scan(
            ExclusiveStartKey=response['LastEvaluatedKey'],
            FilterExpression='begins_with(PK, :prefix) ',
            ExpressionAttributeValues={
                ':prefix': 'Incident',

            }
        )
        delete_items(response['Items'])

def delete_items(items):
    for item in items:
        # Delete each item by PK and SK
        table.delete_item(
            Key={
                'PK': item['PK'],
                'SK': item['SK']  # Assuming your table has SK as well. If not, adjust as needed
            }
        )
        print(f"Deleted item with PK: {item['PK']} and SK: {item['SK']}")

# Run the deletion process
delete_items_with_system_prefix_and_status()
