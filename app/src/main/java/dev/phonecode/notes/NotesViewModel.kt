package dev.phonecode.notes

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.phonecode.notes.data.Note
import dev.phonecode.notes.data.NoteDao
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

class NotesViewModel(private val noteDao: NoteDao) : ViewModel() {
    val notes: Flow<List<Note>> = noteDao.getAllNotes()

    fun getNoteById(id: Long): Flow<Note?> {
        return noteDao.getNoteByIdFlow(id)
    }

    fun saveNote(note: Note) {
        viewModelScope.launch {
            if (note.id == 0L) {
                noteDao.insert(note)
            } else {
                noteDao.update(note)
            }
        }
    }

    fun deleteNote(note: Note) {
        viewModelScope.launch {
            noteDao.delete(note)
        }
    }
}

// Extension to convert suspend to Flow
private fun NoteDao.getNoteByIdFlow(id: Long): Flow<Note?> {
    return kotlinx.coroutines.flow.flow {
        emit(getNoteById(id))
    }
}