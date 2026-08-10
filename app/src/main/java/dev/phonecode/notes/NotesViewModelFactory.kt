package dev.phonecode.notes

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import dev.phonecode.notes.data.NoteDao

class NotesViewModelFactory(private val noteDao: NoteDao) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(NotesViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return NotesViewModel(noteDao) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class")
    }
}