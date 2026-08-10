# bot.py
import discord
from discord.ext import commands

# Initialize the bot with a command prefix
bot = commands.Bot(command_prefix='!')

# Event: Bot is ready
@bot.event
async def on_ready():
    print(f'Logged in as {bot.user.name} (ID: {bot.user.id})')
    print('------')

# Command: Ping
@bot.command()
async def ping(ctx):
    await ctx.send('Pong!')

# Command: Greet
@bot.command()
async def greet(ctx):
    await ctx.send(f'Hello, {ctx.author.mention}!')

# Run the bot with your token
# Replace 'YOUR_BOT_TOKEN' with your actual bot token
bot.run('YOUR_BOT_TOKEN')