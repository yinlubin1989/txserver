import { type NextRequest } from 'next/server'

interface Todo {
  id: number
  title: string
  completed: boolean
  createdAt: string
}

// 内存数据存储
const todos: Todo[] = [
  { id: 1, title: '学习 Next.js 16', completed: false, createdAt: new Date().toISOString() },
  { id: 2, title: '创建 TodoList 应用', completed: true, createdAt: new Date().toISOString() },
  { id: 3, title: '部署到 Vercel', completed: false, createdAt: new Date().toISOString() },
]

let nextId = 4

// GET: 返回所有 todos
export async function GET() {
  return Response.json({ todos })
}

// POST: 创建新 todo
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { title } = body

    if (!title || typeof title !== 'string') {
      return Response.json({ error: 'title 是必填字段' }, { status: 400 })
    }

    const newTodo: Todo = {
      id: nextId++,
      title: title.trim(),
      completed: false,
      createdAt: new Date().toISOString(),
    }

    todos.push(newTodo)
    return Response.json({ todo: newTodo }, { status: 201 })
  } catch {
    return Response.json({ error: '无效的 JSON 数据' }, { status: 400 })
  }
}

// PUT: 更新 todo
export async function PUT(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const idParam = searchParams.get('id')

    if (!idParam) {
      return Response.json({ error: 'id 查询参数是必填的' }, { status: 400 })
    }

    const id = parseInt(idParam, 10)
    if (isNaN(id)) {
      return Response.json({ error: 'id 必须是有效数字' }, { status: 400 })
    }

    const body = await request.json()
    const { title, completed } = body

    const todoIndex = todos.findIndex((t) => t.id === id)
    if (todoIndex === -1) {
      return Response.json({ error: '未找到该 todo' }, { status: 404 })
    }

    const todo = todos[todoIndex]
    if (title !== undefined && typeof title === 'string') {
      todo.title = title.trim()
    }
    if (completed !== undefined && typeof completed === 'boolean') {
      todo.completed = completed
    }

    return Response.json(todo)
  } catch {
    return Response.json({ error: '无效的 JSON 数据' }, { status: 400 })
  }
}

// DELETE: 删除 todo
export async function DELETE(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const idParam = searchParams.get('id')

  if (!idParam) {
    return Response.json({ error: 'id 查询参数是必填的' }, { status: 400 })
  }

  const id = parseInt(idParam, 10)
  if (isNaN(id)) {
    return Response.json({ error: 'id 必须是有效数字' }, { status: 400 })
  }

  const todoIndex = todos.findIndex((t) => t.id === id)
  if (todoIndex === -1) {
    return Response.json({ error: '未找到该 todo' }, { status: 404 })
  }

  const deletedTodo = todos.splice(todoIndex, 1)[0]
  return Response.json(deletedTodo)
}
