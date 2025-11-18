from google import genai

client = genai.Client(api_key="AIzaSyDMeBypr5QwUdXAjVTRmfOmWnDXlcJNNK4")

myfile = client.files.upload(file="./models/inputVoice.mp3")

response = client.models.generate_content(
    model="gemini-2.5-flash-lite",
    contents=[
        "just return the in text format without chnages only text nothing else",
        myfile
    ]
)

print(response.text)
