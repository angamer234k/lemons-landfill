#!/bin/bash

# Simple Number Guessing Game in Bash

number_to_guess=$((RANDOM % 10 + 1))
attempts=0

read -p "Welcome to the Number Guessing Game! I'm thinking of a number between 1 and 10. Enter your guess: " guess
attempts=$((attempts + 1))

while [ $guess -ne $number_to_guess ]; do
    if [ $guess -lt $number_to_guess ]; then
        read -p "Too low! Try again: " guess
    else
        read -p "Too high! Try again: " guess
    fi
    attempts=$((attempts + 1))
done

echo "Congratulations! You guessed the number in $attempts attempts."